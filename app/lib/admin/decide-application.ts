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
  /** Tenant org id — application + recipient lookups/writes are scoped to this. */
  orgId:           string;
  /** Tenant slug — used to build the right per-tenant portal URL in emails.
   *  When unset we fall back to bare /portal (legacy raising-arrows host). */
  orgSlug?:        string;
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

/** Returns the profile id, or THROWS. Never resolves to null: an approved
 *  recipient with a null profile_id is one the family can never reach. */
async function inviteOrFindUser(email: string, redirectTo: string): Promise<string> {
  const supabase = supabaseService();
  const { data: invited, error: invErr } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (invErr && !/already.*registered|exists/i.test(invErr.message)) {
    throw new Error(`invite failed: ${invErr.message}`);
  }
  if (invited?.user?.id) return invited.user.id;

  // The family already has an account. Find them by email in `profiles`,
  // which a database trigger populates for every auth user (001_init.sql).
  //
  // This used to call listUsers() with no arguments — GoTrue returns only the
  // newest 50 users, and auth.users is global across every tenant, so any
  // family who signed up earlier simply wasn't in the page. profile_id was
  // then set to null on an approved recipient: the approval email went out,
  // the admin saw success, and the family's portal said "not linked to an
  // approved grant" forever, with uploads rejected.
  const { data: profile } = await supabase
    .from("profiles").select("id").ilike("email", email).maybeSingle();
  if (profile?.id) return profile.id;

  // Fallback: page through the auth users. Bounded, but no longer capped at
  // the first 50.
  for (let page = 1; page <= 20; page++) {
    const { data: list } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    const users = list?.users ?? [];
    const hit = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (users.length < 200) break; // last page
  }

  // Never proceed with a null profile_id. Approving without one produces a
  // recipient the family can never reach. Failing here leaves the application
  // 'pending', which this module's ordering makes safe to retry.
  throw new Error(
    `Could not create or find a login for ${email}. The application has NOT been approved — check the address and try again.`,
  );
}

export async function decideApplication(args: DecideArgs): Promise<DecideResult> {
  const supabase = supabaseService();

  // Load + validate current state
  const { data: app, error: loadErr } = await supabase
    .from("applications")
    .select("*")
    .eq("id", args.applicationId)
    .eq("org_id", args.orgId)
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
      .eq("org_id", args.orgId)
      .eq("status", "pending")
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await notifyApplicationDenied({
      to:           app.contact_email,
      parent_names: app.parent_names,
      admin_notes:  args.notes || "",
      orgId:        args.orgId,
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

  // 1. Invite or find existing user. The invite-redirect lands them on the
  //    tenant-specific portal URL so they don't end up in the wrong tenant.
  const portalPath = args.orgSlug ? `/o/${args.orgSlug}/portal` : "/portal";
  const portalAbsUrl = `${args.origin}${portalPath}`;
  const profileId = await inviteOrFindUser(app.contact_email, portalAbsUrl);

  // 2. Upsert recipient (idempotent — safe to retry).
  // Default submission_deadline = 6 months from approval date.
  const deadline = new Date();
  deadline.setMonth(deadline.getMonth() + 6);
  const submissionDeadline = deadline.toISOString().split("T")[0];

  const { data: recipient, error: recErr } = await supabase
    .from("recipients")
    .upsert(
      {
        org_id:              args.orgId,
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
    .eq("org_id", args.orgId)
    .eq("status", "pending")
    .select("*")
    .single();
  if (updErr) {
    throw new Error(`status update failed: ${updErr.message}`);
  }

  // The welcome email greets the family in the program's own name. Looked up
  // here rather than added to DecideArgs, so every existing call site (REST
  // route, MCP tool, admin chat) gets it right without changing.
  const { data: tenantRow } = await supabase
    .from("tenants").select("name").eq("id", args.orgId).maybeSingle();

  // 4. Notify — fire-and-forget inside notify.ts (logs failures, never raises).
  //    ONE email at this moment. It was briefly two (a decision notice plus a
  //    welcome), but they pointed at the same next action — open your portal —
  //    and the family already gets Supabase's separate sign-in link. Three
  //    emails in one minute means the useful one gets skipped.
  await notifyApplicationApproved({
    to:              app.contact_email,
    parent_names:    app.parent_names,
    approved_amount: cap,
    rate,
    deadline:        submissionDeadline,
    portal_url:      portalAbsUrl,
    org_name:        tenantRow?.name ?? null,
    orgId:           args.orgId,
  });

  return { application: updated, recipient };
}
