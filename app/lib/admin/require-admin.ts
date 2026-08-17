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
import { isTenantAccessBlocked } from "@/app/lib/tenant-access";

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
 *
 * Pass IS:
 *  - org_members.role IN ('owner','admin') for ctx.id, OR
 *  - profiles.role = 'super_admin' (platform support backdoor — matches
 *    the DB-side is_platform_super() in our RLS policies)
 *
 * Pause enforcement: tenants in status='paused' or 'canceled' return 423
 * (Locked) so admin actions stop working, but super_admin bypasses so
 * Kevin can still poke at a misbehaving tenant from /platform.
 */
export async function requireAdmin(): Promise<AdminAuth> {
  const ctx = await getOrgContext();
  if (!ctx) throw new AdminAuthError(400, "no tenant resolved for this host");

  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new AdminAuthError(401, "unauthorized");

  const svc = supabaseService();

  // Two parallel checks: per-tenant org_members role + platform-wide super_admin.
  const [{ data: membership }, { data: profile }] = await Promise.all([
    svc.from("org_members").select("role").eq("org_id", ctx.id).eq("user_id", user.id).maybeSingle(),
    svc.from("profiles").select("role").eq("id", user.id).maybeSingle(),
  ]);

  const isOrgAdmin     = membership?.role === "owner" || membership?.role === "admin";
  const isPlatformSuper = profile?.role === "super_admin";
  if (!isOrgAdmin && !isPlatformSuper) {
    throw new AdminAuthError(403, "forbidden");
  }

  // Access gate — ALLOW-list (active/trialing/past_due/free). Blocks paused,
  // canceled, unpaid, incomplete*, and any unknown status. super_admin bypass
  // keeps support paths open.
  if (!isPlatformSuper && isTenantAccessBlocked(ctx.status, ctx.trial_ends_at)) {
    throw new AdminAuthError(423, `tenant is ${ctx.status}`);
  }

  return { user, ctx };
}
