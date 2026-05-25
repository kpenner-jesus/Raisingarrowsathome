// ============================================================
//  Admin route guard — tenant-aware
//
//  Every admin API route should call requireAdmin() at the top
//  to:
//    1. Resolve the caller's tenant via the request (host or
//       middleware-injected x-ra-org-slug header)
//    2. Verify the caller is signed in
//    3. Verify they are owner OR admin in that org
//
//  Returns the OrgContext + the signed-in user. Throws a tagged
//  error with an HTTP status the caller can map to a response.
//
//  Why a wrapper? The same 12-line check was being duplicated in
//  every admin route file — easy to forget the .eq("org_id") on
//  one query and leak across tenants. Funnel everyone through one
//  function with a clear contract.
// ============================================================

import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { getOrgContext, type OrgContext } from "@/app/lib/org-context";

export class AdminAuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface AdminAuth {
  user: { id: string; email?: string | null };
  ctx:  OrgContext;
}

/**
 * Resolve tenant + signed-in user + admin-role check. Throws AdminAuthError
 * on any failure (caller maps to NextResponse with .status).
 */
export async function requireAdmin(): Promise<AdminAuth> {
  const ctx = await getOrgContext();
  if (!ctx) throw new AdminAuthError(400, "no tenant resolved for this host");

  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new AdminAuthError(401, "unauthorized");

  const svc = supabaseService();
  const { data: membership } = await svc
    .from("org_members")
    .select("role")
    .eq("org_id", ctx.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership?.role !== "owner" && membership?.role !== "admin") {
    throw new AdminAuthError(403, "forbidden");
  }

  return { user, ctx };
}
