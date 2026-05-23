// ============================================================
//  Shared logic for application approve/deny.
//
//  Used by both the REST API route (admin UI) and the MCP tool
//  (decide_application). Order of operations is critical:
//
//    approve:
//      1. Validate inputs
//      2. Invite user (or find existing) → profile_id
//      3. Upsert recipient row (idempotent on application_id)
//      4. Update application status → 'approved'  ← atomic last step
//      5. Notify
//
//    deny:
//      1. Update application status → 'denied'
//      2. Notify
//
//  If any step before #4 fails, the application stays 'pending'
//  so the admin can safely retry without orphan recipient rows
//  or stuck "approved-but-no-recipient" states.
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

async function inviteOrFindUser(email: string, redirectTo: string): Promise<string | null> {
  const supabase = supabaseService();
  const { data: invited, error: invErr } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (invErr && !/already.*registered|exists/i.test(invErr.message)) {
    throw new Error(`invite failed: ${invErr.message}`);
  }
  if (invited?.user?.id) return invited.user.id;

  // User already existed — look up by email
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
  if (!args.approved_amount || args.approved_amount <= 0) {
    throw new Error("approved_amount required and must be positive");
  }
  const rate = args.rate ?? 0.75;
  if (rate < 0 || rate > 1) throw new Error("rate must be 0–1");

  // 1. Invite or find existing user
  const profileId = await inviteOrFindUser(app.contact_email, `${args.origin}/portal`);

  // 2. Upsert recipient (idempotent — safe to retry)
  const { data: recipient, error: recErr } = await supabase
    .from("recipients")
    .upsert(
      {
        application_id:     app.id,
        profile_id:         profileId,
        approved_amount:    args.approved_amount,
        reimbursement_rate: rate,
      },
      { onConflict: "application_id" }
    )
    .select("*")
    .single();
  if (recErr) throw new Error(`recipient upsert failed: ${recErr.message}`);

  // 3. Update app status — atomic final commit
  const { data: updated, error: updErr } = await supabase
    .from("applications")
    .update({
      status:      "approved",
      admin_notes: args.notes || null,
      decided_at:  new Date().toISOString(),
      decided_by:  args.deciderProfileId,
    })
    .eq("id", args.applicationId)
    .select("*")
    .single();
  if (updErr) {
    // Recipient was created but app status update failed — surface error.
    // Recipient row is benign and will be reused on retry (upsert).
    throw new Error(`status update failed: ${updErr.message}`);
  }

  // 4. Notify — fire-and-forget, failures logged but never raised.
  await notifyApplicationApproved({
    to:              app.contact_email,
    parent_names:    app.parent_names,
    approved_amount: args.approved_amount,
    rate,
    portal_url:      `${args.origin}/portal`,
  });

  return { application: updated, recipient };
}
