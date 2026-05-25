// PATCH /api/platform/tenant-status
//
// Super-admin only. Sets a tenant's status to one of:
//   active | paused | canceled | trialing
//
// Used by /platform to pause a misbehaving tenant or resume them.
// Pause does NOT cancel the Stripe subscription — billing keeps flowing
// while the portal is unavailable to applicants/recipients. Use the
// Stripe dashboard to cancel for-real.

import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set(["active", "paused", "canceled", "trialing", "free"]);

export async function PATCH(req: Request) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const svc = supabaseService();
  const { data: profile } = await svc.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "super_admin") {
    return NextResponse.json({ error: "Super-admin only." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as any));
  const orgId  = typeof body?.orgId  === "string" ? body.orgId  : null;
  const status = typeof body?.status === "string" ? body.status : null;
  if (!orgId)  return NextResponse.json({ error: "orgId required" },  { status: 400 });
  if (!status || !VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: `status must be one of: ${Array.from(VALID_STATUSES).join(", ")}` }, { status: 400 });
  }

  const { error } = await svc.from("tenants").update({ status }).eq("id", orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, orgId, status });
}
