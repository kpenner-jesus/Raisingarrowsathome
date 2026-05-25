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

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Hard 404 outside non-prod envs.
  if (!isImpersonationAllowed()) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Auth check
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Role check via service role (avoids RLS edge cases)
  const svc = supabaseService();
  const { data: profile } = await svc
    .from("profiles")
    .select("role, email")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  if (!isAdmin) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as any));
  const action: string = body?.action;

  // ── STOP path: clear cookie + audit ──────────────────────
  if (action === "stop") {
    const res = NextResponse.json({ ok: true, mode: "self" });
    res.cookies.set(IMPERSONATE_COOKIE, "", { path: "/", maxAge: 0 });
    const testId = await getTestRecipientId();
    await writeAudit({
      actorId:     user.id,
      action:      "impersonate_stop",
      targetTable: "recipients",
      targetId:    testId ?? "00000000-0000-0000-0000-000000000000",
    });
    return res;
  }

  // ── START path: cookie + wipe + reset email + audit ──────
  if (action === "start") {
    const testId = await getTestRecipientId();
    if (!testId) {
      return NextResponse.json({
        error: "test_recipient_id not configured in app_settings — seed it first",
      }, { status: 500 });
    }

    // Wipe transient data on the test recipient so the next session
    // starts from a clean slate. (Best effort — failures are logged
    // but don't block the toggle.)
    const wipeResults = await Promise.allSettled([
      svc.from("receipts").delete().eq("recipient_id", testId),
      svc.from("photos").delete().eq("recipient_id", testId),
      svc.from("testimonials").delete().eq("recipient_id", testId),
      // payouts table: clear rows linked to this recipient
      svc.from("payouts").delete().eq("recipient_id", testId),
    ]);

    // Update the test recipient's contact_email (on the linked
    // application) to the admin's email so notification messages
    // land in their inbox. application_id is on the recipient row.
    const { data: rec } = await svc
      .from("recipients")
      .select("application_id")
      .eq("id", testId)
      .maybeSingle();
    if (rec?.application_id && profile?.email) {
      await svc
        .from("applications")
        .update({ contact_email: profile.email })
        .eq("id", rec.application_id);
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
