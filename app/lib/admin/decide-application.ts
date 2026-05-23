// ============================================================
//  Shared logic for application approve/deny.
//
//  Used by both the REST API route (admin UI) and the MCP tool
//  (decide_application).
//
//  Atomic order:
//    approve:
//      1. Validate inputs (strict numeric types)
//      2. Invite user (or find existing) → profile_id
//      3. Upsert recipient row (idempotent on application_id)
//      4. Update application status → 'approved'  ← atomic last step
//      5. Notify
//
//    deny:
//      1. Update application status → 'denied'
//      2. Notify
//
//  If any step before #4 fails, the application stays 'pending' so
//  admin can safely retry without orphan recipient rows or stuck
//  "approved-but-no-recipient" states.
// ============================================================

import { supabaseService } from "@/app/lib/supabase/server";
import {
  notifyApplicationApproved,
  notifyApplicationDenied,
} from "@/app/lib/notify";

export interface DecideArgs {
  applicationId:   string;
  decision:        "approved" | "denied";
  approved_amount?: number;
  rate?:            number;
  notes?:           string;
  deciderProfileId: string;
  origin:           string;
}

export interface DecideResult {
  application: any;
  recipient?:  any;
}

const MAX_CAP = 50_000;   // $CAD sanity limit per recipient

async function inviteOrFindUser(email: string, redirectTo: string): Promise<string | null> {
  const supabase = supabaseService();
  const { data: invited, error: invErr } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (invErr && !/already.*registered|exists/i.test(invErr.message)) {
    throw new Error(`invite failed: ${invErr.message}`);
  }
  if (invited?.user?.id) return invited.user.id;

  const { data: list } = await supabase.auth.admin.listUsers();
  return list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
}

export async function decideApplication(args: DecideArgs): Promise<DecideResult> {
  const supabase = supabaseService();

  // Load + validate current state
  const { data: app, error: loadErr } = await supabase
    .from("applications")
    .select("*")
    .eq("id", args.applicationId)
    .single();
  if (loadErr || !app) throw new Error(loadErr?.message || "application not found");
  if (app.status !== "pending") {
    throw new Error(`application already decided (status: ${app.status})`);
  }

  // ── DENY PATH ────────────────────────────────────────────────
  if (args.decision === "denied") {
    const { data: updated, error } = await supabase
      .from("applications")
      .update({
        status:      "denied",
        admin_notes: args.notes || null,
        decided_at:  new Date().toISOString(),
        decided_by:  args.deciderProfileId,
      })
      .eq("id", args.applicationId)
      .eq("status", "pending")
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await notifyApplicationDenied({
      to:           app.contact_email,
      parent_names: app.parent_names,
      admin_notes:  args.notes || "",
    });

    return { application: updated };
  }

  // ── APPROVE PATH ─────────────────────────────────────────────
  // Strict numeric validation: reject strings, NaN, Infinity, negatives, over-cap.
  const cap = args.approved_amount;
  if (typeof cap !== "number" || !Number.isFinite(cap) || cap <= 0) {
    throw new Error("approved_amount must be a positive finite number");
  }
  if (cap > MAX_CAP) {
    throw new Error(`approved_amount exceeds maximum (${MAX_CAP})`);
  }
  const rate = args.rate ?? 0.75;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error("rate must be a finite number between 0 and 1");
  }

  // 1. Invite or find existing user
  const profileId = await inviteOrFindUser(app.contact_email, `${args.origin}/portal`);

  // 2. Upsert recipient (idempotent — safe to retry).
  // Default submission_deadline = 6 months from approval date.
  const deadline = new Date();
  deadline.setMonth(deadline.getMonth() + 6);
  const submissionDeadline = deadline.toISOString().split("T")[0];

  const { data: recipient, error: recErr } = await supabase
    .from("recipients")
    .upsert(
      {
        application_id:      app.id,
        profile_id:          profileId,
        approved_amount:     cap,
        reimbursement_rate:  rate,
        submission_deadline: submissionDeadline,
        grandfathered:       false,
      },
      { onConflict: "application_id" }
    )
    .select("*")
    .single();
  if (recErr) throw new Error(`recipient upsert failed: ${recErr.message}`);

  // 3. Update app status — atomic final commit (only if still pending)
  const { data: updated, error: updErr } = await supabase
    .from("applications")
    .update({
      status:      "approved",
      admin_notes: args.notes || null,
      decided_at:  new Date().toISOString(),
      decided_by:  args.deciderProfileId,
    })
    .eq("id", args.applicationId)
    .eq("status", "pending")
    .select("*")
    .single();
  if (updErr) {
    throw new Error(`status update failed: ${updErr.message}`);
  }

  // 4. Notify — fire-and-forget inside notify.ts (logs failures, never raises).
  await notifyApplicationApproved({
    to:              app.contact_email,
    parent_names:    app.parent_names,
    approved_amount: cap,
    rate,
    portal_url:      `${args.origin}/portal`,
  });

  return { application: updated, recipient };
}
