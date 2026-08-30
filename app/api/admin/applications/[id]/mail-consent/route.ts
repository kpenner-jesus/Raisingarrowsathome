// ============================================================
//  POST /api/admin/applications/[id]/mail-consent
//
//  Record that a family has asked to start or stop receiving mail
//  from CEO Ministries.
//
//  This exists because the application form promises "you can ask
//  us to stop at any time". Until there was a way to act on that,
//  the promise was decoration — the tick-box could be set by the
//  family once and never changed by anyone.
//
//  mail_consent_at is "when the answer last changed", set here on
//  BOTH directions. The authoritative history of who changed it and
//  when is audit_log, which cannot be updated or deleted.
// ============================================================

import { NextResponse } from "next/server";
import { supabaseService } from "@/app/lib/supabase/server";
import { requireAdmin, AdminAuthError } from "@/app/lib/admin/require-admin";
import { writeAudit } from "@/app/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  let auth;
  try { auth = await requireAdmin(); }
  catch (e) {
    if (e instanceof AdminAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { ctx: orgCtx, user } = auth;

  const body = await req.json().catch(() => ({} as any));
  if (typeof body?.consent !== "boolean") {
    return NextResponse.json({ error: "consent must be true or false" }, { status: 400 });
  }
  const consent: boolean = body.consent;

  const svc = supabaseService();
  const now = new Date().toISOString();

  const { data: app, error } = await svc.from("applications")
    .update({ mail_consent: consent, mail_consent_at: now })
    .eq("id", params.id).eq("org_id", orgCtx.id)      // org-scoped, always
    .select("id, parent_names").single();
  if (error || !app) {
    return NextResponse.json({ error: error?.message || "application not found" }, { status: 404 });
  }

  // Keep the approved family's record in step — that is the row a mailing
  // list would actually be built from.
  await svc.from("recipients")
    .update({ mail_consent: consent })
    .eq("application_id", params.id).eq("org_id", orgCtx.id);

  await writeAudit({
    orgId: orgCtx.id,
    actorId: user.id,
    action: consent ? "mail_consent_granted" : "mail_consent_withdrawn",
    targetTable: "applications",
    targetId: params.id,
    details: { family: app.parent_names, consent, at: now },
  }).catch(() => { /* never fail the change on its own bookkeeping */ });

  return NextResponse.json({ ok: true, mail_consent: consent, mail_consent_at: now });
}
