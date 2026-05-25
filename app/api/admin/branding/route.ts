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

  const body = await req.json().catch(() => ({} as any));
  const orgId       = typeof body?.orgId === "string" ? body.orgId : null;
  const logo_url    = body?.logo_url === null ? null : (typeof body?.logo_url === "string" ? body.logo_url.trim() : null);
  const brand_color = typeof body?.brand_color === "string" ? body.brand_color.trim() : null;

  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 });
  if (logo_url && !/^https?:\/\//i.test(logo_url)) {
    return NextResponse.json({ error: "logo_url must be an http(s) URL" }, { status: 400 });
  }
  if (brand_color && !HEX_RE.test(brand_color)) {
    return NextResponse.json({ error: "brand_color must be a 6-digit hex (e.g. #e8793a)" }, { status: 400 });
  }

  const svc = supabaseService();
  const { data: membership } = await svc
    .from("org_members").select("role")
    .eq("org_id", orgId).eq("user_id", user.id).maybeSingle();
  if (membership?.role !== "owner") {
    return NextResponse.json({ error: "Only the org owner can change branding." }, { status: 403 });
  }

  const updates: Record<string, any> = {};
  if (logo_url !== undefined)    updates.logo_url    = logo_url;
  if (brand_color !== undefined && brand_color !== null) updates.brand_color = brand_color;

  const { error } = await svc.from("tenants").update(updates).eq("id", orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
