// POST /api/admin/email-domain/verify — owner asks Resend for current
// verification status of the tenant's domain. Updates tenants.sender_verified
// to reflect the answer; returns the latest DNS records too so the UI can
// re-display them.

import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const orgId = typeof body?.orgId === "string" ? body.orgId : null;
  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 });

  const svc = supabaseService();
  const { data: membership } = await svc
    .from("org_members").select("role")
    .eq("org_id", orgId).eq("user_id", user.id).maybeSingle();
  if (membership?.role !== "owner") {
    return NextResponse.json({ error: "Only the org owner can verify sending domain." }, { status: 403 });
  }

  const { data: tenant } = await svc.from("tenants")
    .select("sender_resend_domain_id").eq("id", orgId).maybeSingle();
  if (!tenant?.sender_resend_domain_id) {
    return NextResponse.json({ error: "No domain configured for this org yet." }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 503 });

  // First, ask Resend to attempt verification (no-op if already verified).
  await fetch(`https://api.resend.com/domains/${tenant.sender_resend_domain_id}/verify`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}` },
  }).catch(() => null);

  // Then fetch the current state + records.
  const resGet = await fetch(`https://api.resend.com/domains/${tenant.sender_resend_domain_id}`, {
    method: "GET",
    headers: { "Authorization": `Bearer ${apiKey}` },
  });
  const info = await resGet.json().catch(() => ({}));
  if (!resGet.ok) {
    return NextResponse.json({ error: info?.message || `Resend returned ${resGet.status}` }, { status: 502 });
  }

  const verified = info?.status === "verified";
  await svc.from("tenants").update({
    sender_verified: verified,
  }).eq("id", orgId);

  return NextResponse.json({
    ok: true,
    status: info?.status,
    verified,
    records: info?.records || [],
  });
}
