// PATCH /api/admin/branding
//
// Owner-only. Updates tenants.logo_url + tenants.brand_color.
// Validates: brand_color must be 6-digit hex, logo_url must be https://.

import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export async function PATCH(req: Request) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const orgId = typeof body?.orgId === "string" ? body.orgId : null;
  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 });

  // Distinguish "key absent" (don't touch the column) from "key present null
  // or empty" (set to NULL / reject). Without this distinction a future caller
  // that omits logo_url would clobber the existing logo to NULL.
  const hasLogoUrl    = Object.prototype.hasOwnProperty.call(body, "logo_url");
  const hasBrandColor = Object.prototype.hasOwnProperty.call(body, "brand_color");

  let logoUrl: string | null = null;
  if (hasLogoUrl) {
    const v = body.logo_url;
    if (v === null) {
      logoUrl = null;
    } else if (typeof v === "string") {
      const trimmed = v.trim();
      logoUrl = trimmed.length === 0 ? null : trimmed;
    } else {
      return NextResponse.json({ error: "logo_url must be a string or null" }, { status: 400 });
    }
    // Require https:// so the logo doesn't break with mixed-content blocks on
    // secure tenant pages. Owner can clear by sending null or "".
    if (logoUrl && !/^https:\/\//i.test(logoUrl)) {
      return NextResponse.json({ error: "logo_url must start with https:// (http:// is blocked on secure pages)" }, { status: 400 });
    }
  }

  let brandColor: string | null = null;
  if (hasBrandColor) {
    const v = body.brand_color;
    if (typeof v !== "string") {
      return NextResponse.json({ error: "brand_color must be a string" }, { status: 400 });
    }
    brandColor = v.trim();
    if (!HEX_RE.test(brandColor)) {
      return NextResponse.json({ error: "brand_color must be a 6-digit hex (e.g. #e8793a)" }, { status: 400 });
    }
  }

  const svc = supabaseService();
  const { data: membership } = await svc
    .from("org_members").select("role")
    .eq("org_id", orgId).eq("user_id", user.id).maybeSingle();
  if (membership?.role !== "owner") {
    return NextResponse.json({ error: "Only the org owner can change branding." }, { status: 403 });
  }

  const updates: Record<string, any> = {};
  if (hasLogoUrl)    updates.logo_url    = logoUrl;
  if (hasBrandColor) updates.brand_color = brandColor;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update — pass logo_url and/or brand_color." }, { status: 400 });
  }

  const { error } = await svc.from("tenants").update(updates).eq("id", orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
