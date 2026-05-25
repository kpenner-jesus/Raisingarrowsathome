// ============================================================
//  POST /api/admin/impersonate
//
//  Admin-only "view as test grantee" toggle. NEVER available
//  on production deploys.
//
//  Body:  { action: "start" | "stop" }
//  - "start": sets cookie `ra_impersonate=<test_recipient_id>`,
//             wipes the test recipient's receipts/photos/
//             testimonials/payouts so the next session starts
//             clean, sets the test recipient's contact_email to
//             the admin's email so any outbound emails land in
//             the admin's inbox during testing.
//  - "stop" : clears the cookie.
//
//  Every toggle writes to audit_log.
// ============================================================

import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import {
  IMPERSONATE_COOKIE,
  getTestRecipientId,
  isImpersonationAllowed,
} from "@/app/lib/impersonation";
import { writeAudit } from "@/app/lib/audit";
import { getOrgContext } from "@/app/lib/org-context";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Hard 404 outside non-prod envs.
  if (!isImpersonationAllowed()) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Resolve the tenant. Impersonation is a per-tenant feature now — every
  // wipe/update below is scoped to this org so a bad cookie can never reach
  // another tenant's data.
  const orgCtx = await getOrgContext();
  if (!orgCtx) {
    return NextResponse.json({ error: "no tenant resolved for this host" }, { status: 400 });
  }

  // Auth check
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Tenant-level admin check via org_members (per-tenant role).
  const svc = supabaseService();
  const { data: membership } = await svc.from("org_members")
    .select("role").eq("org_id", orgCtx.id).eq("user_id", user.id).maybeSingle();
  const isAdmin = membership?.role === "owner" || membership?.role === "admin";
  if (!isAdmin) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  // We still need the actor email for the test-recipient impersonation
  // (so notifications during the session land in their inbox).
  const { data: profile } = await svc
    .from("profiles").select("email").eq("id", user.id).maybeSingle();

  const body = await req.json().catch(() => ({} as any));
  const action: string = body?.action;

  // ── STOP path: clear cookie + reset test app's contact_email + audit ──
  if (action === "stop") {
    const res = NextResponse.json({ ok: true, mode: "self" });
    res.cookies.set(IMPERSONATE_COOKIE, "", { path: "/", maxAge: 0 });
    const testId = await getTestRecipientId(orgCtx.id);
    // Reset test app's contact_email so it doesn't keep the last admin's
    // address bleeding across demo sessions. Best-effort; failures logged.
    if (testId) {
      const { data: rec } = await svc
        .from("recipients").select("application_id")
        .eq("id", testId).eq("org_id", orgCtx.id).maybeSingle();
      if (rec?.application_id) {
        await svc.from("applications")
          .update({ contact_email: "test@example.com" })
          .eq("id", rec.application_id).eq("org_id", orgCtx.id);
      }
    }
    await writeAudit({
      orgId:       orgCtx.id,
      actorId:     user.id,
      action:      "impersonate_stop",
      targetTable: "recipients",
      targetId:    testId ?? "00000000-0000-0000-0000-000000000000",
    });
    return res;
  }

  // ── START path: cookie + wipe + reset email + audit ──────
  if (action === "start") {
    const testId = await getTestRecipientId(orgCtx.id);
    if (!testId) {
      // Configuration gap, not a runtime crash. Return 503 so the UI can
      // distinguish "feature not set up here" from "code broken".
      return NextResponse.json({
        error: "Impersonation isn't configured on this deploy. Seed app_settings.test_recipient_id with a recipient UUID first.",
        code: "not_configured",
      }, { status: 503 });
    }

    // Wipe transient data on the test recipient so the next session
    // starts from a clean slate. (Best effort — failures are logged
    // but don't block the toggle.) All scoped to this tenant.
    const wipeResults = await Promise.allSettled([
      svc.from("receipts").delete().eq("recipient_id", testId).eq("org_id", orgCtx.id),
      svc.from("photos").delete().eq("recipient_id", testId).eq("org_id", orgCtx.id),
      svc.from("testimonials").delete().eq("recipient_id", testId).eq("org_id", orgCtx.id),
      // payouts table: clear rows linked to this recipient
      svc.from("payouts").delete().eq("recipient_id", testId).eq("org_id", orgCtx.id),
    ]);

    // Update the test recipient's contact_email (on the linked
    // application) to the admin's email so notification messages
    // land in their inbox. application_id is on the recipient row.
    const { data: rec } = await svc
      .from("recipients")
      .select("application_id")
      .eq("id", testId)
      .eq("org_id", orgCtx.id)
      .maybeSingle();
    if (rec?.application_id && profile?.email) {
      await svc
        .from("applications")
        .update({ contact_email: profile.email })
        .eq("id", rec.application_id)
        .eq("org_id", orgCtx.id);
    }

    const res = NextResponse.json({
      ok: true,
      mode: "impersonating",
      test_recipient_id: testId,
      wipe_results: wipeResults.map((r) => r.status),
    });
    res.cookies.set(IMPERSONATE_COOKIE, testId, {
      path: "/",
      httpOnly: false,            // readable on client too for banner
      sameSite: "lax",
      maxAge: 60 * 60 * 8,        // 8 hours — long enough for a demo
    });

    await writeAudit({
      orgId:       orgCtx.id,
      actorId:     user.id,
      action:      "impersonate_start",
      targetTable: "recipients",
      targetId:    testId,
      details:     { contact_email: profile?.email ?? null },
    });

    return res;
  }

  return NextResponse.json({ error: "action must be 'start' or 'stop'" }, { status: 400 });
}
