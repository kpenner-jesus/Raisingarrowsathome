// ============================================================
//  MCP tools — wraps existing admin operations.
//
//  Auth is enforced at /api/mcp route (Bearer → admin profile).
//  Each handler uses supabaseService() (RLS bypass) since the
//  HTTP layer has already verified admin role.
//
//  Multi-tenant: every read/write on a tenant-scoped table MUST
//  filter by ctx.org_id (read) or stamp org_id: ctx.org_id (insert).
//  Tenant tables: applications, recipients, receipts, photos,
//  payouts, payout_batches, testimonials, broadcasts,
//  email_templates, app_settings, audit_log, email_events,
//  email_optouts, api_tokens, application_notes, recipient_notes,
//  admin_invites, receipt_categories.
// ============================================================

import { randomUUID } from "crypto";
import { supabaseService } from "@/app/lib/supabase/server";
import { calcBalance } from "@/app/lib/grant-calc";
import { decideApplication as decideApp } from "@/app/lib/admin/decide-application";
import { generatePayoutsForOrg } from "@/app/lib/payouts";
import { assertPathBelongsToOrg } from "@/app/lib/storage-path";
import { DELETABLE_TABLES, specFor, assertReason, describeImpact } from "./deletable";
import { writeAudit } from "@/app/lib/audit";
import {
  notifyReceiptApproved,
  notifyReceiptRejected,
  notifyBatchPaid,
} from "@/app/lib/notify";

export interface ToolContext {
  profile_id: string;
  origin:     string;
  /** Tenant the bearer token is scoped to — every DB read/write below must
   *  filter or stamp by this. */
  org_id:     string;
  /** Tenant slug — used to build correct portal URLs in transactional emails
   *  so path-routed tenants don't send links pointing at the host-default
   *  tenant's portal. */
  slug?:      string;
  /** Most-recent receipt photo the admin attached in chat (base64 + media
   *  type). Set by the chat route from the latest image block in the message
   *  history; consumed by create_receipt to upload + attach the image. Not
   *  set for the external MCP server. */
  receiptImage?: { data: string; mediaType: string };
}

/**
 * Build a portal URL that lands recipients on the RIGHT tenant's portal.
 * Uses NEXT_PUBLIC_PLATFORM_URL (or the request origin) + /o/<slug>/portal
 * when slug is known; else legacy bare /portal (raising-arrows fallback).
 */
function portalUrl(ctx: ToolContext): string {
  const platform = process.env.NEXT_PUBLIC_PLATFORM_URL || ctx.origin;
  return ctx.slug ? `${platform}/o/${ctx.slug}/portal` : `${platform}/portal`;
}

interface Tool {
  name:        string;
  description: string;
  inputSchema: Record<string, any>;
  handler:     (args: any, ctx: ToolContext) => Promise<any>;
  /** Tools that depend on the in-app chat channel (e.g. an attached image)
   *  and can't function over the external MCP server. Hidden from MCP
   *  tools/list and rejected by tools/call. */
  chatOnly?:   boolean;
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
  handler: async ({ status, limit = 50 }, ctx) => {
    const supabase = supabaseService();
    let q = supabase.from("applications")
      .select("id, app_ref, parent_names, city, contact_email, status, created_at, children")
      .eq("org_id", ctx.org_id)
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
  handler: async ({ id }, ctx) => {
    const supabase = supabaseService();
    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .eq("id", id)
      .eq("org_id", ctx.org_id)
      .single();
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
  handler: async ({ status, limit = 100 }, ctx) => {
    const supabase = supabaseService();
    let q = supabase.from("recipients")
      .select("id, approved_amount, reimbursement_rate, status, created_at, applications!inner(app_ref, parent_names, city, contact_email)")
      .eq("org_id", ctx.org_id)
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
  description: "Full recipient details including balance breakdown (approved receipts, paid, committed, remaining, eligible for next payout) and the full receipts array.",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
  handler: async ({ id }, ctx) => {
    const supabase = supabaseService();
    const { data: recipient, error } = await supabase
      .from("recipients")
      .select("*, applications(*)")
      .eq("id", id)
      .eq("org_id", ctx.org_id)
      .single();
    if (error) throw new Error(error.message);

    const { data: receipts } = await supabase
      .from("receipts")
      // currency + reimbursable_amount feed calcBalance — without them the
      // assistant quotes an admin a different balance than the family sees
      // on their own portal page.
      .select("id, amount, status, currency, reimbursable_amount, description, purchase_date, created_at")
      .eq("recipient_id", id)
      .eq("org_id", ctx.org_id)
      .order("created_at", { ascending: false });
    const { data: payouts } = await supabase
      .from("payouts")
      .select("amount, status")
      .eq("recipient_id", id)
      .eq("org_id", ctx.org_id);
    const committedToDate = (payouts || []).filter((p: any) => p.status !== "cancelled").reduce((s: number, p: any) => s + Number(p.amount), 0);
    const paidToDate      = (payouts || []).filter((p: any) => p.status === "paid").reduce((s: number, p: any) => s + Number(p.amount), 0);

    const balance = calcBalance({
      receipts:        receipts || [],
      rate:            Number(recipient.reimbursement_rate),
      cap:             Number(recipient.approved_amount),
      paidToDate,
      committedToDate,
    });

    return { ...recipient, balance, receipts: receipts || [] };
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
  handler: async ({ recipient_id, status, limit = 100 }, ctx) => {
    const supabase = supabaseService();
    let q = supabase.from("receipts")
      .select("*")
      .eq("org_id", ctx.org_id)
      .order("created_at", { ascending: false })
      .limit(limit);
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
  handler: async ({ recipient_id, limit = 50 }, ctx) => {
    const supabase = supabaseService();
    let q = supabase.from("testimonials")
      .select("*")
      .eq("org_id", ctx.org_id)
      .order("created_at", { ascending: false })
      .limit(limit);
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
  handler: async ({ recipient_id }, ctx) => {
    const supabase = supabaseService();
    const { data, error } = await supabase
      .from("photos")
      .select("*")
      .eq("recipient_id", recipient_id)
      .eq("org_id", ctx.org_id)
      .order("created_at", { ascending: false });
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
  handler: async ({ status, limit = 24 }, ctx) => {
    const supabase = supabaseService();
    let q = supabase.from("payout_batches")
      .select("*")
      .eq("org_id", ctx.org_id)
      .order("scheduled_date", { ascending: false })
      .limit(limit);
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
  handler: async ({ id }, ctx) => {
    const supabase = supabaseService();
    const { data: batch, error: bErr } = await supabase
      .from("payout_batches")
      .select("*")
      .eq("id", id)
      .eq("org_id", ctx.org_id)
      .single();
    if (bErr) throw new Error(bErr.message);
    const { data: lines } = await supabase
      .from("payouts")
      .select("*, recipients!inner(approved_amount, applications!inner(parent_names, contact_email, city, app_ref))")
      .eq("batch_id", id)
      .eq("org_id", ctx.org_id);
    return { ...batch, lines: lines || [] };
  },
};

const getReceiptImageUrl: Tool = {
  name:        "get_receipt_image_url",
  description: "Generates a short-lived signed URL for a receipt's image, resolved by the receipt's id (not by an arbitrary storage path). Scoped to a real receipt row to prevent enumeration.",
  inputSchema: {
    type: "object",
    properties: {
      receipt_id: { type: "string" },
      ttl_secs:   { type: "number", default: 300 },
    },
    required: ["receipt_id"],
  },
  handler: async ({ receipt_id, ttl_secs = 300 }, ctx) => {
    const supabase = supabaseService();
    const { data: receipt, error: loadErr } = await supabase
      .from("receipts")
      .select("image_path")
      .eq("id", receipt_id)
      .eq("org_id", ctx.org_id)
      .single();
    if (loadErr || !receipt) throw new Error(loadErr?.message || "receipt not found");
    // Defence-in-depth: row was org-filtered, but if image_path was ever
    // mutated to point at another tenant's file the embedded tenant segment
    // catches it. Requires 3-segment <user>/<org>/<file>; THROWS otherwise
    // (surfaced as a JSON-RPC error). Verified zero legacy rows in prod.
    assertPathBelongsToOrg(receipt.image_path, ctx.org_id);
    // Clamped, because ttl_secs is chosen by the MODEL and this tool is
    // read-only — so it runs with no human confirmation. Text a family typed
    // into their own receipt description could otherwise talk the assistant
    // into minting a year-long public link to someone's receipt.
    const ttl = Math.min(Math.max(Number(ttl_secs) || 300, 60), 900);
    const { data, error } = await supabase.storage.from("receipts").createSignedUrl(receipt.image_path, ttl);
    if (error) throw new Error(error.message);
    return { signed_url: data.signedUrl, expires_in_secs: ttl };
  },
};

const getPhotoImageUrl: Tool = {
  name:        "get_photo_image_url",
  description: "Generates a short-lived signed URL for a photo, resolved by the photo's id.",
  inputSchema: {
    type: "object",
    properties: {
      photo_id: { type: "string" },
      ttl_secs: { type: "number", default: 300 },
    },
    required: ["photo_id"],
  },
  handler: async ({ photo_id, ttl_secs = 300 }, ctx) => {
    const supabase = supabaseService();
    const { data: photo, error: loadErr } = await supabase
      .from("photos")
      .select("image_path")
      .eq("id", photo_id)
      .eq("org_id", ctx.org_id)
      .single();
    if (loadErr || !photo) throw new Error(loadErr?.message || "photo not found");
    // See get_receipt_image_url for rationale.
    assertPathBelongsToOrg(photo.image_path, ctx.org_id);
    // Same clamp as get_receipt_image_url.
    const ttl = Math.min(Math.max(Number(ttl_secs) || 300, 60), 900);
    const { data, error } = await supabase.storage.from("photos").createSignedUrl(photo.image_path, ttl);
    if (error) throw new Error(error.message);
    return { signed_url: data.signedUrl, expires_in_secs: ttl };
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
      orgId:            ctx.org_id,
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
  description: "Approve or reject a receipt. Only acts on receipts currently in 'pending' status — already-decided receipts return a 'already decided' error to prevent silent re-emails. A USD receipt CANNOT be approved without reimbursable_amount: we never convert currency automatically, so the admin must say what it is worth in CAD. Use reimbursable_amount for a partial reimbursement too (e.g. excluding shipping).",
  inputSchema: {
    type: "object",
    properties: {
      id:       { type: "string" },
      decision: { type: "string", enum: ["approved", "rejected"] },
      notes:    { type: "string" },
      reimbursable_amount: { type: "number", description: "CAD amount to reimburse. REQUIRED for a USD receipt. Omit on a CAD receipt to use the family's normal rate." },
    },
    required: ["id", "decision"],
  },
  handler: async ({ id, decision, notes, reimbursable_amount }, ctx) => {
    const supabase = supabaseService();
    const { data: receipt, error: loadErr } = await supabase
      .from("receipts")
      // currency is load-bearing: without it this tool approved USD receipts
      // that the admin UI refuses, leaving reimbursable_amount NULL so the
      // receipt was approved but worth nothing, with nothing flagging it.
      .select("id, amount, currency, description, status, recipients!inner(applications!inner(parent_names, contact_email))")
      .eq("id", id)
      .eq("org_id", ctx.org_id)
      .single();
    if (loadErr || !receipt) throw new Error(loadErr?.message || "receipt not found");
    if (receipt.status !== "pending") throw new Error(`receipt already ${receipt.status}`);

    // Same rule as the admin UI (api/admin/receipts/[id]/decide): we never
    // convert currency ourselves, so a USD receipt needs an explicit CAD figure.
    let cleanReimbursable: number | null = null;
    if (reimbursable_amount !== undefined && reimbursable_amount !== null) {
      const v = Number(reimbursable_amount);
      if (!Number.isFinite(v) || v < 0) throw new Error("reimbursable_amount must be a positive number of CAD");
      if (v > 50_000) throw new Error("reimbursable_amount exceeds the 50,000 sanity limit");
      cleanReimbursable = v;
    }
    if (decision === "approved" && (receipt as any).currency === "USD" && cleanReimbursable === null) {
      throw new Error(
        "This receipt is in USD. Ask the admin what it is worth in Canadian dollars and pass that as reimbursable_amount — we never convert currency automatically.",
      );
    }

    const update: Record<string, any> = {
      status:      decision,
      admin_notes: notes || null,
      decided_at:  new Date().toISOString(),
      decided_by:  ctx.profile_id,
    };
    if (decision === "approved" && cleanReimbursable !== null) {
      update.reimbursable_amount = cleanReimbursable;
    }

    const { error, data: updRow } = await supabase
      .from("receipts")
      .update(update)
      .eq("id", id)
      .eq("org_id", ctx.org_id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updRow) throw new Error("receipt was concurrently decided");

    const application = (receipt as any).recipients.applications;
    const notifyArgs  = {
      to:           application.contact_email,
      parent_names: application.parent_names,
      amount:       Number(receipt.amount),
      description:  receipt.description || "",
      portal_url:   portalUrl(ctx),
      orgId:        ctx.org_id,
    };
    if (decision === "approved") await notifyReceiptApproved(notifyArgs);
    else                          await notifyReceiptRejected({ ...notifyArgs, admin_notes: notes || "" });

    return { ok: true, receipt_id: id, decision };
  },
};

/** Detect a receipt file's real format from its leading magic bytes. Returns
 *  the canonical media type, or null if the bytes aren't an allowed image/PDF. */
function sniffReceiptMime(buf: Buffer): string | null {
  if (buf.length >= 5 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44
      && buf[3] === 0x46 && buf[4] === 0x2d) return "application/pdf"; // "%PDF-"
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
      && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return "image/png";
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif";
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
      && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "image/webp";
  return null;
}

const createReceipt: Tool = {
  name:        "create_receipt",
  description:
    "Create a receipt for a recipient from the receipt photo or PDF the admin attached in this chat. " +
    "Read the attachment, then provide the recipient_id, total amount, currency, purchase date, and a short " +
    "description of what was purchased. Use list_recipients first to resolve the recipient_id from a " +
    "family name if the admin gave a name. The receipt is created as 'pending' and appears in the normal " +
    "review queue. REQUIRES an attached photo or PDF — if none was attached, ask the admin to attach it.",
  chatOnly: true,
  inputSchema: {
    type: "object",
    properties: {
      recipient_id:  { type: "string", description: "The recipient the receipt belongs to (resolve via list_recipients if given a name)." },
      amount:        { type: "number", description: "Total amount shown on the receipt." },
      currency:      { type: "string", enum: ["CAD", "USD"], default: "CAD" },
      purchase_date: { type: "string", description: "Purchase date in YYYY-MM-DD as printed on the receipt. Receipts are often historical — never substitute today's date; leave it out if it isn't legible." },
      description:   { type: "string", description: "Short description of the purchase (e.g. 'Sonlight Core A curriculum')." },
    },
    required: ["recipient_id", "amount"],
  },
  handler: async ({ recipient_id, amount, currency = "CAD", purchase_date, description }, ctx) => {
    if (!ctx.receiptImage?.data) {
      throw new Error("No receipt photo or PDF is attached to this chat. Ask the admin to attach one, then try again.");
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > 50_000) {
      throw new Error("amount must be a positive number up to 50,000");
    }
    const cur = currency === "USD" ? "USD" : "CAD";

    const supabase = supabaseService();

    // Resolve the recipient (org-scoped). profile_id (when the family has a
    // login) becomes the storage folder so they can self-view the image; else
    // fall back to the admin's id. Either way the row stays org-scoped.
    const { data: recipient, error: rErr } = await supabase
      .from("recipients")
      .select("id, profile_id, org_id")
      .eq("id", recipient_id)
      .eq("org_id", ctx.org_id)
      .single();
    if (rErr || !recipient) throw new Error(rErr?.message || "recipient not found in this org");

    // Sniff the REAL format from magic bytes — never trust the client-declared
    // media_type for the stored Content-Type or extension.
    const bytes   = Buffer.from(ctx.receiptImage.data, "base64");
    const sniffed = sniffReceiptMime(bytes);
    if (!sniffed) throw new Error("the attached file is not a valid JPEG, PNG, WebP, GIF, or PDF");
    const ext =
      sniffed === "application/pdf" ? "pdf"  :
      sniffed === "image/png"       ? "png"  :
      sniffed === "image/webp"      ? "webp" :
      sniffed === "image/gif"       ? "gif"  : "jpg";
    const folder = recipient.profile_id || ctx.profile_id;
    const path   = `${folder}/${ctx.org_id}/${randomUUID()}.${ext}`;
    assertPathBelongsToOrg(path, ctx.org_id); // <user>/<org>/<file> with org segment == ctx.org_id

    const { error: upErr } = await supabase.storage
      .from("receipts")
      .upload(path, bytes, { contentType: sniffed, upsert: false });
    if (upErr) throw new Error(`image upload failed: ${upErr.message}`);

    const { data: row, error: insErr } = await supabase
      .from("receipts")
      .insert({
        org_id:              ctx.org_id,
        recipient_id:        recipient.id,
        image_path:          path,
        amount:              amt,
        currency:            cur,
        reimbursable_amount: null,
        purchase_date:       purchase_date || null,
        description:         (description || "").slice(0, 500),
        status:              "pending",
      })
      .select("id, amount, currency, purchase_date, description, status")
      .single();
    if (insErr) {
      // Roll back the orphaned upload so a failed insert doesn't leave a file.
      await supabase.storage.from("receipts").remove([path]).catch(() => {});
      throw new Error(insErr.message);
    }

    return { created: true, receipt: row };
  },
};

const MAX_RECIPIENT_CAP = 50_000;

const modifyRecipient: Tool = {
  name:        "modify_recipient",
  description: "Update a recipient's approved_amount, reimbursement_rate, and/or status. approved_amount is capped at $50,000 (sanity limit).",
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
  handler: async ({ id, approved_amount, reimbursement_rate, status }, ctx) => {
    const update: Record<string, any> = {};
    if (approved_amount !== undefined) {
      if (typeof approved_amount !== "number" || !Number.isFinite(approved_amount) || approved_amount < 0) {
        throw new Error("approved_amount must be a non-negative finite number");
      }
      if (approved_amount > MAX_RECIPIENT_CAP) {
        throw new Error(`approved_amount exceeds maximum (${MAX_RECIPIENT_CAP})`);
      }
      update.approved_amount = approved_amount;
    }
    if (reimbursement_rate !== undefined) {
      if (typeof reimbursement_rate !== "number" || !Number.isFinite(reimbursement_rate) || reimbursement_rate < 0 || reimbursement_rate > 1) {
        throw new Error("reimbursement_rate must be a finite number between 0 and 1");
      }
      update.reimbursement_rate = reimbursement_rate;
    }
    if (status !== undefined) update.status = status;
    if (Object.keys(update).length === 0) throw new Error("no fields to update");

    const supabase = supabaseService();
    const { data, error } = await supabase
      .from("recipients")
      .update(update)
      .eq("id", id)
      .eq("org_id", ctx.org_id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
};

const generatePayoutBatch: Tool = {
  name:        "generate_payout_batch",
  description: "Generate a payout batch from currently eligible recipients in this tenant (same logic as the monthly cron). Atomic: scheduled/approved payouts already in flight count as committed, so a second call before the first batch is paid won't duplicate. Returns batch id and total.",
  inputSchema: { type: "object", properties: {} },
  handler: async (_args, ctx) => {
    const result = await generatePayoutsForOrg(ctx.org_id, "manual");
    if (result.skipped) {
      throw new Error(result.skipped.reason);
    }
    return { batch_id: result.batch_id, total: result.total, lines: result.lines };
  },
};

const markBatchPaid: Tool = {
  name:        "mark_batch_paid",
  description: "Mark a payout batch as paid (after CEO Ministries has actually sent e-transfers). Idempotent: an already-paid batch returns `already_paid: true` without re-emailing.",
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

    const { data: batch, error: loadErr } = await supabase
      .from("payout_batches")
      .select("id, status, paid_at")
      .eq("id", batch_id)
      .eq("org_id", ctx.org_id)
      .single();
    if (loadErr || !batch) throw new Error(loadErr?.message || "batch not found");
    if (batch.status === "paid") {
      return { ok: true, already_paid: true, batch_id, paid_at: batch.paid_at, recipients_notified: 0 };
    }

    const { data: payouts } = await supabase
      .from("payouts")
      .select("amount, recipients!inner(applications!inner(parent_names, contact_email))")
      .eq("batch_id", batch_id)
      .eq("org_id", ctx.org_id)
      .in("status", ["scheduled", "approved"]);

    const now = new Date().toISOString();
    const updPayouts = await supabase.from("payouts")
      .update({ status: "paid", paid_at: now })
      .eq("batch_id", batch_id)
      .eq("org_id", ctx.org_id)
      .in("status", ["scheduled", "approved"]);
    if (updPayouts.error) throw new Error(updPayouts.error.message);

    const updBatch = await supabase.from("payout_batches").update({
      status:        "paid",
      paid_at:       now,
      ceo_reference: ceo_reference || null,
    })
      .eq("id", batch_id)
      .eq("org_id", ctx.org_id)
      .neq("status", "paid");
    if (updBatch.error) throw new Error(updBatch.error.message);

    // Sequential, and count only real sends. This was Promise.all with
    // recipients_notified = payouts.length — a ROW COUNT, not a send count —
    // so a rate-limited or bounced batch still recorded in audit_log that
    // every family had been told their money was on the way.
    let notified = 0;
    for (const p of ((payouts as any[]) || [])) {
      const ok = await notifyBatchPaid({
        to:           p.recipients.applications.contact_email,
        parent_names: p.recipients.applications.parent_names,
        amount:       Number(p.amount),
        portal_url:   portalUrl(ctx),
        orgId:        ctx.org_id,
      }).catch(() => false);
      if (ok) notified++;
    }

    return { ok: true, batch_id, recipients_notified: notified, recipients_total: (payouts || []).length };
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
  handler: async ({ batch_id }, ctx) => {
    const supabase = supabaseService();
    const { data: batch } = await supabase
      .from("payout_batches")
      .select("*")
      .eq("id", batch_id)
      .eq("org_id", ctx.org_id)
      .single();
    if (!batch) throw new Error("batch not found");
    const { data: payouts } = await supabase
      .from("payouts")
      .select("amount, status, receipts_included, recipients!inner(approved_amount, reimbursement_rate, applications!inner(parent_names, contact_email, contact_phone, city, app_ref))")
      .eq("batch_id", batch_id)
      .eq("org_id", ctx.org_id);

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
      await supabase
        .from("payout_batches")
        .update({ status: "exported", exported_at: new Date().toISOString() })
        .eq("id", batch.id)
        .eq("org_id", ctx.org_id);
    }
    return csv;
  },
};

// ──────────────────────────────────────────────────────────────
//  Registry
// ──────────────────────────────────────────────────────────────

const bulkCreateRecipients: Tool = {
  name:        "bulk_create_recipients",
  description: "Bulk-import recipients (e.g. from a legacy spreadsheet). Each row creates a skeleton 'approved' application + recipient. Use for grandfathered families that predate the online funnel. The 'paid_to_date' field, if provided, creates a legacy payout row so balance math is accurate. Safe to re-run: a row whose contact_email already exists in this program is SKIPPED, not duplicated — report the skipped rows to the admin.",
  inputSchema: {
    type: "object",
    properties: {
      grandfathered: { type: "boolean", default: true, description: "Mark recipients as grandfathered (no submission_deadline)" },
      rows: {
        type: "array",
        items: {
          type: "object",
          properties: {
            parent_names:        { type: "string" },
            contact_email:       { type: "string" },
            contact_phone:       { type: "string" },
            address_street:      { type: "string" },
            address_city:        { type: "string" },
            address_postal:      { type: "string" },
            approved_amount:     { type: "number" },
            reimbursement_rate:  { type: "number", default: 0.75 },
            submission_deadline: { type: "string", description: "YYYY-MM-DD; omit for grandfathered (null deadline)" },
            paid_to_date:        { type: "number", description: "If provided, creates a legacy paid batch + payout for this amount" },
            notes:               { type: "string" },
          },
          required: ["parent_names", "contact_email", "approved_amount"],
        },
      },
    },
    required: ["rows"],
  },
  handler: async ({ rows, grandfathered = true }, ctx) => {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error("rows must be a non-empty array");
    const supabase = supabaseService();
    const results: any[] = [];
    const today = new Date().toISOString();
    const todayDate = today.split("T")[0];

    for (const r of rows) {
      try {
        if (!r.parent_names || !r.contact_email || !Number.isFinite(Number(r.approved_amount))) {
          throw new Error("missing required fields");
        }

        // Same limits every other write path enforces. Without them a
        // spreadsheet cell holding 3 instead of 0.3 imported a 300%
        // reimbursement rate: a family with a $5,000 cap and $2,000 of
        // receipts would be paid the full cap instead of $1,500.
        const amt = Number(r.approved_amount);
        if (amt <= 0 || amt > MAX_RECIPIENT_CAP) {
          throw new Error(`approved_amount must be between 0 and ${MAX_RECIPIENT_CAP}`);
        }
        const rateVal = Number(r.reimbursement_rate ?? 0.75);
        if (!Number.isFinite(rateVal) || rateVal < 0 || rateVal > 1) {
          throw new Error("reimbursement_rate must be between 0 and 1 (0.75 = 75%)");
        }

        // IDEMPOTENCY. Every row was a bare INSERT and app_ref carried a
        // random suffix, so the (org_id, app_ref) unique index could never
        // catch a re-run. A retried import — an operator re-clicking after a
        // timeout — created a second application, recipient and, where
        // paid_to_date was set, a second "paid" payout. That is exactly the
        // production incident: 7 duplicate families and 4 phantom payouts
        // totalling $2,190.38.
        //
        // A family is identified by their email within the org. Re-running
        // the same sheet is now a no-op that reports what it skipped.
        const email = String(r.contact_email).trim().toLowerCase();
        const { data: existing } = await supabase
          .from("applications")
          .select("id, recipients(id)")
          .eq("org_id", ctx.org_id)
          // Escaped: in ILIKE, `_` matches any character and `%` matches
          // anything, so 'mary_jones@x.com' would match 'maryXjones@x.com'
          // and the import would skip a family that had never been imported,
          // reporting a confident wrong reason.
          .ilike("contact_email", email.replace(/([\\%_])/g, "\\$1"))
          .limit(1)
          .maybeSingle();
        if (existing) {
          results.push({
            parent_names: r.parent_names,
            contact_email: r.contact_email,
            skipped: true,
            reason: "already imported — a family with this email already exists in this program",
            application_id: existing.id,
          });
          continue;
        }
        const firstName = String(r.parent_names).split(/[\s&]/).filter(Boolean)[0] || "FAMILY";
        const randSuffix = Math.random().toString(36).slice(2, 6).toUpperCase();
        const app_ref = `RA-BULK-${firstName.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 12)}-${randSuffix}`;

        const { data: app, error: appErr } = await supabase.from("applications").insert({
          org_id:            ctx.org_id,
          app_ref,
          parent_names:      r.parent_names,
          city:              r.address_city || "—",
          contact_email:     r.contact_email,
          contact_phone:     r.contact_phone || "—",
          income_range:      "—",
          current_schooling: "—",
          children:          [],
          answers:           { _bulk_import: r.notes || "Imported via MCP bulk_create_recipients" },
          status:            "approved",
          admin_notes:       r.notes || "Bulk imported via MCP",
          decided_at:        today,
        }).select("id").single();
        if (appErr) throw new Error(appErr.message);

        const { data: recipient, error: recErr } = await supabase.from("recipients").insert({
          org_id:              ctx.org_id,
          application_id:      app.id,
          profile_id:          null,
          approved_amount:     amt,
          reimbursement_rate:  rateVal,
          status:              "active",
          address_street:      r.address_street || null,
          address_city:        r.address_city || null,
          address_postal:      r.address_postal || null,
          submission_deadline: r.submission_deadline || null,
          grandfathered:       !!grandfathered,
        }).select("id").single();
        if (recErr) {
          // Roll back the application insert so failed rows don't leave
          // orphan applications with no recipient. Scoped by org_id for
          // defence-in-depth (same as every other write in this tool).
          await supabase.from("applications").delete().eq("id", app.id).eq("org_id", ctx.org_id);
          throw new Error(recErr.message);
        }

        // Full rollback of the row's application + recipient. Used by the
        // legacy-payout failure paths so a row that fails AFTER the recipient
        // was created doesn't leave a half-imported family (which would
        // double-count approved_amount + drop paid_to_date on re-import).
        const rollbackRow = async () => {
          await supabase.from("recipients").delete().eq("id", recipient.id).eq("org_id", ctx.org_id);
          await supabase.from("applications").delete().eq("id", app.id).eq("org_id", ctx.org_id);
        };

        let legacy_payout_id: string | null = null;
        if (r.paid_to_date && Number(r.paid_to_date) > 0) {
          const { data: batch, error: batchErr } = await supabase.from("payout_batches").insert({
            org_id:         ctx.org_id,
            scheduled_date: todayDate,
            status:         "paid",
            total:          Number(r.paid_to_date),
            ceo_reference:  "PRE-PORTAL IMPORT",
            paid_at:        today,
            exported_at:    today,
            bucket:         "legacy",
          }).select("id").single();
          if (batchErr) {
            await rollbackRow();
            throw new Error(`legacy payout_batches insert failed: ${batchErr.message}`);
          }
          if (batch) {
            const { data: payout, error: payoutErr } = await supabase.from("payouts").insert({
              org_id:            ctx.org_id,
              batch_id:          batch.id,
              recipient_id:      recipient.id,
              amount:            Number(r.paid_to_date),
              receipts_included: [],
              status:            "paid",
              paid_at:           today,
              payment_method:    "e-transfer (pre-portal)",
              payment_reference: "imported via MCP",
            }).select("id").single();
            if (payoutErr) {
              // Roll back the empty batch + the application/recipient so the
              // whole row fails atomically and re-import won't duplicate it.
              await supabase.from("payout_batches").delete().eq("id", batch.id).eq("org_id", ctx.org_id);
              await rollbackRow();
              throw new Error(`legacy payouts insert failed: ${payoutErr.message}`);
            }
            legacy_payout_id = payout?.id || null;
          }
        }

        results.push({ ok: true, parent_names: r.parent_names, recipient_id: recipient.id, legacy_payout_id });
      } catch (e: any) {
        results.push({ ok: false, parent_names: r.parent_names, error: e?.message || String(e) });
      }
    }
    const summary = {
      total:    rows.length,
      created:  results.filter((x) => x.ok).length,
      failed:   results.filter((x) => !x.ok).length,
    };
    return { summary, results };
  },
};

const setUserRole: Tool = {
  // IN-APP CHAT ONLY, for the same reason delete_record is: an API token is a
  // weaker credential than a signed-in admin, and this tool mints a PERMANENT
  // human owner of the tenant. A leaked token could promote an account the
  // attacker controls, and revoking the token would not take that access away.
  chatOnly:    true,
  name:        "set_user_role",
  description: "Promote/demote a team member's role within THIS tenant. Caller must be the org owner OR a platform super_admin. Safety: won't demote the last owner of the org.",
  inputSchema: {
    type: "object",
    properties: {
      email: { type: "string" },
      role:  { type: "string", enum: ["recipient", "admin", "owner"] },
    },
    required: ["email", "role"],
  },
  handler: async ({ email, role }, ctx) => {
    const supabase = supabaseService();

    // Caller must be platform super_admin OR owner of THIS org.
    const [{ data: actor }, { data: callerMembership }] = await Promise.all([
      supabase.from("profiles").select("role").eq("id", ctx.profile_id).single(),
      supabase.from("org_members").select("role").eq("org_id", ctx.org_id).eq("user_id", ctx.profile_id).maybeSingle(),
    ]);
    const isCallerPlatformSuper = actor?.role === "super_admin";
    const isCallerOrgOwner      = callerMembership?.role === "owner";
    if (!isCallerPlatformSuper && !isCallerOrgOwner) {
      throw new Error("only platform super_admin or org owner can change roles");
    }

    const { data: targetProfile, error: loadErr } = await supabase.from("profiles").select("id, email").eq("email", email).single();
    if (loadErr || !targetProfile) throw new Error("user not found");

    const { data: targetMembership } = await supabase
      .from("org_members").select("role")
      .eq("org_id", ctx.org_id).eq("user_id", targetProfile.id)
      .maybeSingle();
    const fromRole = targetMembership?.role ?? "recipient";

    // Refuse to leave the org without owners.
    if (fromRole === "owner" && role !== "owner") {
      const { count } = await supabase.from("org_members")
        .select("*", { count: "exact", head: true })
        .eq("org_id", ctx.org_id)
        .eq("role", "owner");
      if ((count ?? 0) <= 1) throw new Error("cannot demote the last owner");
    }

    if (role === "recipient") {
      // Delete the org_members row (recipients have no membership row).
      if (targetMembership) {
        await supabase.from("org_members")
          .delete()
          .eq("org_id", ctx.org_id).eq("user_id", targetProfile.id);
      }
    } else {
      await supabase.from("org_members").upsert(
        { org_id: ctx.org_id, user_id: targetProfile.id, role },
        { onConflict: "org_id,user_id" }
      );
    }

    await supabase.from("audit_log").insert({
      org_id:       ctx.org_id,
      actor_id:     ctx.profile_id,
      action:       "team.role_change",
      target_table: "org_members",
      target_id:    targetProfile.id,
      details:      { email, from: fromRole, to: role },
    });

    return { ok: true, email, from: fromRole, to: role };
  },
};

// ──────────────────────────────────────────────────────────────
//  EMAIL TEMPLATES
//
//  Templates are per-tenant, keyed (org_id, key). A key only DOES
//  anything if some sender looks it up — creating a new key stores copy
//  but nothing will send it until code references it. The tool
//  descriptions say so, because a model asked to "make a reminder email"
//  would otherwise create a row and report success.
//
//  Retiring a template ARCHIVES it (archived_at) rather than deleting:
//  the copy someone wrote survives, and loadTemplate() skips archived
//  rows so the sender falls back to its hardcoded default. Archiving a
//  template therefore changes what is sent, but never stops the email.
// ──────────────────────────────────────────────────────────────

/** Keys the code actually looks up. Anything else is stored but never sent. */
const WIRED_TEMPLATE_KEYS = [
  "welcome_family",
  "application_approved",
  "application_denied",
  "receipt_approved",
  "receipt_rejected",
  "batch_paid",
];

const MAX_SUBJECT = 200;
const MAX_BODY    = 50_000;

function validTemplateKey(key: string): string {
  const k = String(key || "").trim().toLowerCase();
  if (!/^[a-z0-9_]{3,60}$/.test(k)) {
    throw new Error("key must be 3-60 characters of lowercase letters, numbers or underscores (e.g. welcome_family)");
  }
  return k;
}

const listEmailTemplates: Tool = {
  name:        "list_email_templates",
  description:
    "List this program's email templates. Shows which are active and which are archived, and which keys the " +
    "system actually sends. Set include_archived to see retired ones too.",
  inputSchema: {
    type: "object",
    properties: {
      include_archived: { type: "boolean", default: false },
    },
  },
  handler: async ({ include_archived = false }, ctx) => {
    // select("*") + filter in JS: migrations are applied by hand here, so
    // this can run against a database that predates archived_at, and naming
    // the column would fail the whole call.
    const { data, error } = await supabaseService()
      .from("email_templates")
      .select("*")
      .eq("org_id", ctx.org_id)
      .order("label");
    if (error) throw new Error(error.message);
    return (data || [])
      .filter((t: any) => include_archived || !t.archived_at)
      .map((t: any) => ({
      key: t.key, label: t.label, subject: t.subject, vars: t.vars, updated_at: t.updated_at,
      archived_at: t.archived_at ?? null,
      archived: Boolean(t.archived_at),
      sent_by_the_system: WIRED_TEMPLATE_KEYS.includes(t.key),
    }));
  },
};

const getEmailTemplate: Tool = {
  name:        "get_email_template",
  description: "Full contents of one email template, including the HTML and plain-text bodies.",
  inputSchema: {
    type: "object",
    properties: { key: { type: "string", description: "Template key, e.g. welcome_family." } },
    required: ["key"],
  },
  handler: async ({ key }, ctx) => {
    const { data, error } = await supabaseService()
      .from("email_templates").select("*")
      .eq("org_id", ctx.org_id).eq("key", validTemplateKey(key)).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data)  throw new Error(`No email template with key "${key}" in this program.`);
    return { ...data, archived: Boolean(data.archived_at), sent_by_the_system: WIRED_TEMPLATE_KEYS.includes(data.key) };
  },
};

const createEmailTemplate: Tool = {
  name:        "create_email_template",
  description:
    "Create a new email template for this program. Use {{variable}} placeholders in the subject and body. " +
    "IMPORTANT: a new key is only stored copy — nothing sends it until the system is changed to use that key. " +
    `The keys the system sends today are: ${WIRED_TEMPLATE_KEYS.join(", ")}. If the admin wants to change an ` +
    "existing email, update one of those instead of creating a new one. Say this plainly rather than implying " +
    "a new template will start going out.",
  inputSchema: {
    type: "object",
    properties: {
      key:       { type: "string", description: "Lowercase identifier, e.g. welcome_family." },
      label:     { type: "string", description: "Human name shown in the admin editor." },
      subject:   { type: "string", description: "Subject line. May contain {{variables}}." },
      body_html: { type: "string", description: "HTML body. May contain {{variables}}. Brand header/footer are added automatically." },
      body_text: { type: "string", description: "Optional plain-text version." },
      vars:      { type: "array", items: { type: "string" }, description: "Variable names this template uses, without braces." },
    },
    required: ["key", "label", "subject", "body_html"],
  },
  handler: async ({ key, label, subject, body_html, body_text, vars }, ctx) => {
    const k = validTemplateKey(key);
    if (!String(label || "").trim())   throw new Error("label is required");
    if (!String(subject || "").trim()) throw new Error("subject is required");
    if (String(subject).length > MAX_SUBJECT) throw new Error(`subject must be ${MAX_SUBJECT} characters or fewer`);
    if (!String(body_html || "").trim()) throw new Error("body_html is required");
    if (String(body_html).length > MAX_BODY) throw new Error(`body_html must be ${MAX_BODY} characters or fewer`);
    if (body_text && String(body_text).length > MAX_BODY) throw new Error(`body_text must be ${MAX_BODY} characters or fewer`);

    const { data, error } = await supabaseService()
      .from("email_templates")
      .insert({
        org_id: ctx.org_id, key: k,
        label: String(label).trim(), subject: String(subject).trim(),
        body_html, body_text: body_text ?? null,
        vars: Array.isArray(vars) ? vars.map(String) : [],
        updated_by: ctx.profile_id,
      })
      .select("key, label, subject, vars")
      .single();
    if (error) {
      if ((error as any).code === "23505") {
        throw new Error(`A template with key "${k}" already exists here. Use update_email_template to change it.`);
      }
      throw new Error(error.message);
    }
    await writeAudit({
      orgId: ctx.org_id, actorId: ctx.profile_id, action: "create_email_template",
      targetTable: "email_templates", targetId: k, details: { label, subject },
    });
    return {
      created: true, template: data,
      note: WIRED_TEMPLATE_KEYS.includes(k)
        ? "This key is one the system sends, so it will be used from now on."
        : "Stored, but nothing sends this key yet — it will not go out until the system is changed to use it.",
    };
  },
};

const updateEmailTemplate: Tool = {
  name:        "update_email_template",
  description:
    "Change an existing email template's wording. Pass only the fields to change. Use {{variable}} placeholders. " +
    "Show the admin the new subject and body before proposing, so they approve the actual wording. Editing a key " +
    "the system sends changes what families receive from the next send onward.",
  inputSchema: {
    type: "object",
    properties: {
      key:       { type: "string" },
      label:     { type: "string" },
      subject:   { type: "string" },
      body_html: { type: "string" },
      body_text: { type: "string" },
      vars:      { type: "array", items: { type: "string" } },
    },
    required: ["key"],
  },
  handler: async ({ key, label, subject, body_html, body_text, vars }, ctx) => {
    const k = validTemplateKey(key);
    const patch: Record<string, any> = { updated_at: new Date().toISOString(), updated_by: ctx.profile_id };
    if (label     !== undefined) { if (!String(label).trim()) throw new Error("label cannot be blank"); patch.label = String(label).trim(); }
    if (subject   !== undefined) {
      if (!String(subject).trim()) throw new Error("subject cannot be blank");
      if (String(subject).length > MAX_SUBJECT) throw new Error(`subject must be ${MAX_SUBJECT} characters or fewer`);
      patch.subject = String(subject).trim();
    }
    if (body_html !== undefined) {
      if (!String(body_html).trim()) throw new Error("body_html cannot be blank");
      if (String(body_html).length > MAX_BODY) throw new Error(`body_html must be ${MAX_BODY} characters or fewer`);
      patch.body_html = body_html;
    }
    if (body_text !== undefined) {
      if (body_text && String(body_text).length > MAX_BODY) throw new Error(`body_text must be ${MAX_BODY} characters or fewer`);
      patch.body_text = body_text || null;
    }
    if (vars !== undefined) patch.vars = Array.isArray(vars) ? vars.map(String) : [];
    if (Object.keys(patch).length <= 2) throw new Error("Nothing to change — pass at least one of label, subject, body_html, body_text or vars.");

    const { data, error } = await supabaseService()
      .from("email_templates").update(patch)
      .eq("org_id", ctx.org_id).eq("key", k)
      .select("*").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data)  throw new Error(`No email template with key "${k}" in this program.`);

    await writeAudit({
      orgId: ctx.org_id, actorId: ctx.profile_id, action: "update_email_template",
      targetTable: "email_templates", targetId: k, details: { changed: Object.keys(patch).filter((f) => f !== "updated_at" && f !== "updated_by") },
    });
    return {
      updated: true, template: data,
      note: data.archived_at ? "This template is archived, so the change won't affect anything until it is restored." : undefined,
    };
  },
};

const archiveEmailTemplate: Tool = {
  name:        "archive_email_template",
  description:
    "Retire a template (or bring one back with restore: true). Archiving does NOT delete the wording — it can be " +
    "restored. Be clear about the effect: if the system sends this key, archiving it means those emails go out " +
    "with the built-in default wording instead. It does not stop the email being sent.",
  inputSchema: {
    type: "object",
    properties: {
      key:     { type: "string" },
      restore: { type: "boolean", description: "True to un-archive.", default: false },
    },
    required: ["key"],
  },
  handler: async ({ key, restore = false }, ctx) => {
    const k = validTemplateKey(key);
    const { data, error } = await supabaseService()
      .from("email_templates")
      .update({ archived_at: restore ? null : new Date().toISOString(), updated_by: ctx.profile_id })
      .eq("org_id", ctx.org_id).eq("key", k)
      .select("*").maybeSingle();
    if (error) {
      // 42703 = column does not exist: the archiving migration hasn't been run
      // on this database yet. Say that, rather than a raw Postgres error.
      if ((error as any).code === "42703" || /archived_at/.test(error.message)) {
        throw new Error("Archiving isn't set up on this site yet — the 20260616 database update still needs to be applied. Everything else about templates works.");
      }
      throw new Error(error.message);
    }
    if (!data)  throw new Error(`No email template with key "${k}" in this program.`);

    await writeAudit({
      orgId: ctx.org_id, actorId: ctx.profile_id,
      action: restore ? "restore_email_template" : "archive_email_template",
      targetTable: "email_templates", targetId: k, details: {},
    });
    const wired = WIRED_TEMPLATE_KEYS.includes(k);
    return {
      [restore ? "restored" : "archived"]: true,
      template: data,
      effect: restore
        ? (wired ? "This wording is in use again from the next send." : "Restored. Nothing sends this key.")
        : (wired ? "Those emails will now go out with the built-in default wording. They are NOT stopped." : "Retired. Nothing was sending this key anyway."),
    };
  },
};

// ──────────────────────────────────────────────────────────────
//  DELETE — admin-only, archived, never silent
// ──────────────────────────────────────────────────────────────

/** Count each child row that points at this record, org-scoped. */
async function countChildren(
  rels: { table: string; fk: string }[],
  id: string,
  orgId: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const rel of rels) {
    const { count } = await supabaseService()
      .from(rel.table)
      .select("id", { count: "exact", head: true })
      .eq(rel.fk, id)
      .eq("org_id", orgId);
    counts[`${rel.table}.${rel.fk}`] = count ?? 0;
  }
  return counts;
}

/** Fetch the row, org-scoped. Throws a plain-English error if it isn't there. */
async function fetchDeletable(table: string, id: string, orgId: string): Promise<any> {
  const { data, error } = await supabaseService()
    .from(table).select("*").eq("id", id).eq("org_id", orgId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data)  throw new Error(`No ${specFor(table).label} with id ${id} in this program.`);
  return data;
}

const previewDelete: Tool = {
  name:        "preview_delete",
  description:
    "Show exactly what deleting a record would destroy, WITHOUT deleting anything. Always call this before " +
    "proposing delete_record, and tell the admin what it says — the record's own details, how many related " +
    "rows would be destroyed with it, and whether it changes what a family is owed. Read-only and safe.",
  inputSchema: {
    type: "object",
    properties: {
      table: { type: "string", enum: DELETABLE_TABLES, description: "Which kind of record." },
      id:    { type: "string", description: "The record's id." },
    },
    required: ["table", "id"],
  },
  handler: async ({ table, id }, ctx) => {
    const spec = specFor(table);
    const row  = await fetchDeletable(table, id, ctx.org_id);
    const counts = await countChildren(
      [...spec.cascades, ...spec.restricts, ...spec.unlinks], id, ctx.org_id);
    const impact = describeImpact(spec, counts);

    return {
      table,
      label: spec.label,
      record: row,
      will_also_delete:  impact.destroys.length ? impact.destroys : "nothing",
      will_unlink:       impact.unlinks.length  ? impact.unlinks  : "nothing",
      blocked_by:        impact.blockedBy.length ? impact.blockedBy : null,
      deletes_stored_file: spec.storage ? (row[spec.storage.column] || null) : null,
      changes_family_balance: Boolean(spec.affectsBalance),
      recoverable: "The full record is copied into the audit log before deletion, so it can be restored by hand.",
      cascade_required: impact.destroys.length > 0,
    };
  },
};

const deleteRecord: Tool = {
  name:        "delete_record",
  description:
    "PERMANENTLY delete one record. Use only when the admin has clearly asked for a deletion — for example " +
    "duplicate rows from a bad import, or a payout marked paid that never actually happened. Call preview_delete " +
    "FIRST and state plainly what will be destroyed, including any related rows and any change to what a family " +
    "is owed. One record per call. A written reason is required and is stored in the audit log. If the record " +
    "has related rows that would be destroyed too, you must pass cascade: true, and you must have told the " +
    "admin the counts before they confirm. Never guess at an id — look it up first.",
  inputSchema: {
    type: "object",
    properties: {
      table:   { type: "string", enum: DELETABLE_TABLES, description: "Which kind of record." },
      id:      { type: "string", description: "The record's id." },
      reason:  { type: "string", description: "Why it is being deleted, in a short sentence. Written to the audit log." },
      cascade: { type: "boolean", description: "Required true when related rows would be destroyed with it.", default: false },
    },
    required: ["table", "id", "reason"],
  },
  // IN-APP CHAT ONLY. The loudness of this tool IS the Confirm step, and that
  // lives in the chat UI — over the external MCP server a token holder would
  // delete instantly, with no human between the request and the row going
  // away. An API token is also a weaker credential than a signed-in admin.
  // Without the gate the tool shouldn't exist, so it is hidden there.
  chatOnly: true,
  handler: async ({ table, id, reason, cascade = false }, ctx) => {
    const spec     = specFor(table);
    const why      = assertReason(reason);
    const supabase = supabaseService();

    const row    = await fetchDeletable(table, id, ctx.org_id);
    const counts = await countChildren(
      [...spec.cascades, ...spec.restricts, ...spec.unlinks], id, ctx.org_id);
    const impact = describeImpact(spec, counts);

    if (impact.blockedBy.length) {
      throw new Error(
        `This ${spec.label} still has ${impact.blockedBy.join(", ")} attached to it. ` +
        `Delete those first — the database will not allow this one to go while they exist.`,
      );
    }
    if (impact.destroys.length && !cascade) {
      throw new Error(
        `Deleting this ${spec.label} would also permanently delete ${impact.destroys.join(", ")}. ` +
        `Tell the admin that, and only re-propose with cascade: true if they still want it.`,
      );
    }

    // ARCHIVE FIRST, and fail closed. writeAudit() deliberately swallows its
    // errors so an audit hiccup can't break a normal request — that trade is
    // wrong here: no archive means an unrecoverable delete, so this insert is
    // done directly and the delete is abandoned if it fails.
    const { data: archive, error: archiveErr } = await supabase
      .from("audit_log")
      .insert({
        org_id:       ctx.org_id,
        actor_id:     ctx.profile_id,
        action:       `delete_${table}`,
        target_table: table,
        target_id:    id,
        details: {
          source: "ai_chat",
          reason: why,
          deleted_row: row,
          cascade_counts: counts,
          also_deleted: impact.destroys,
          also_unlinked: impact.unlinks,
        },
      })
      .select("id")
      .single();
    if (archiveErr || !archive) {
      throw new Error(
        `Refusing to delete: couldn't write the recovery copy to the audit log (${archiveErr?.message || "no row returned"}).`,
      );
    }

    const { error: delErr } = await supabase
      .from(table).delete().eq("id", id).eq("org_id", ctx.org_id);
    if (delErr) throw new Error(`Delete failed: ${delErr.message}`);

    // Best-effort file cleanup. The row is already gone, so a storage failure
    // must not read as "the delete failed" — report it instead.
    let storageNote: string | null = null;
    if (spec.storage && row[spec.storage.column]) {
      const { error: sErr } = await supabase.storage
        .from(spec.storage.bucket).remove([row[spec.storage.column]]);
      storageNote = sErr
        ? `The record is deleted, but its stored file could not be removed (${sErr.message}).`
        : null;
    }

    return {
      deleted: true,
      table,
      id,
      what: `${spec.label} deleted`,
      also_deleted: impact.destroys.length ? impact.destroys : "nothing",
      also_unlinked: impact.unlinks.length ? impact.unlinks : "nothing",
      reason: why,
      recovery: `A full copy is in the audit log (entry ${archive.id}) if this needs to be undone.`,
      warning: storageNote,
    };
  },
};

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
  getReceiptImageUrl,
  getPhotoImageUrl,
  decideApplication,
  decideReceipt,
  createReceipt,
  modifyRecipient,
  bulkCreateRecipients,
  setUserRole,
  generatePayoutBatch,
  markBatchPaid,
  exportBatchCsv,
  listEmailTemplates,
  getEmailTemplate,
  createEmailTemplate,
  updateEmailTemplate,
  archiveEmailTemplate,
  previewDelete,
  deleteRecord,
];
