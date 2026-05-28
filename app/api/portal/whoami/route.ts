// GET /api/portal/whoami
//
// Returns { user_id, org_id } for the signed-in portal user in their
// resolved tenant context. Used by client upload pages to build the
// tenant-prefixed storage path before calling storage.upload(...).
//
// Cheap, no DB hit beyond what auth + org resolution already do.
import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { getOrgContext } from "@/app/lib/org-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  // Primary: resolve org from middleware header / Referer path / host.
  const orgCtx = await getOrgContext();
  if (orgCtx) return NextResponse.json({ user_id: user.id, org_id: orgCtx.id });

  // Fallback: /api/* isn't matched by middleware, and a strict Referrer-Policy
  // can strip the /o/<slug> path from the Referer on path-routed tenants. If the
  // user belongs to exactly ONE org, use it — covers the common case (a recipient
  // belongs to a single tenant) without guessing between multiple memberships.
  const svc = supabaseService();
  const { data: memberships } = await svc
    .from("org_members").select("org_id").eq("user_id", user.id).limit(2);
  if (memberships && memberships.length === 1) {
    return NextResponse.json({ user_id: user.id, org_id: memberships[0].org_id });
  }

  return new NextResponse("no tenant resolved for this host", { status: 400 });
}
