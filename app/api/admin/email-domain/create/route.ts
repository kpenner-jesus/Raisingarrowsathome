// POST /api/admin/email-domain/create — owner adds a sending domain
// DELETE /api/admin/email-domain/create — owner removes the configured domain
//
// Uses the platform's Resend API key under the hood. Each tenant verifies
// their own domain against our shared Resend account; deliverability is
// isolated per domain even though the underlying account is shared.

import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

async function requireOwner(req: Request): Promise<{ user: any; orgId: string } | NextResponse> {
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
    return NextResponse.json({ error: "Only the org owner can change sending domain." }, { status: 403 });
  }
  return { user, orgId };
}

export async function POST(req: Request) {
  const cloned = req.clone(); // body is consumed by requireOwner — clone for re-read
  const auth = await requireOwner(cloned);
  if (auth instanceof NextResponse) return auth;
  const { orgId } = auth;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 503 });

  const body = await req.json().catch(() => ({} as any));
  const domain         = typeof body?.domain === "string" ? body.domain.trim().toLowerCase() : "";
  const senderLocalPart = typeof body?.senderLocalPart === "string" ? body.senderLocalPart.trim().toLowerCase() : "notifications";
  const cleanLocal = senderLocalPart.replace(/[^a-z0-9._-]/g, "") || "notifications";

  if (!/^([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/.test(domain)) {
    return NextResponse.json({ error: "Invalid domain format" }, { status: 400 });
  }

  // Refuse domains we already host (raisingarrowsathome.com — that's the
  // shared fallback). Tenant must use a domain they control.
  if (domain === "raisingarrowsathome.com" || domain.endsWith(".raisingarrowsathome.com")) {
    return NextResponse.json({ error: "That domain is reserved for the platform. Use your own org's domain." }, { status: 400 });
  }

  // Create the domain on Resend.
  const resCreate = await fetch("https://api.resend.com/domains", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: domain }),
  });
  const created = await resCreate.json().catch(() => ({}));
  if (!resCreate.ok) {
    return NextResponse.json({ error: created?.message || `Resend returned ${resCreate.status}` }, { status: 400 });
  }

  // Persist on the tenant. records[] returned in the create call already.
  const svc = supabaseService();
  await svc.from("tenants").update({
    sender_domain:           domain,
    sender_email:            `${cleanLocal}@${domain}`,
    sender_resend_domain_id: created.id,
    sender_verified:         false,
  }).eq("id", orgId);

  return NextResponse.json({
    ok: true,
    status: created.status || "pending",
    records: created.records || [],
  });
}

export async function DELETE(req: Request) {
  const cloned = req.clone();
  const auth = await requireOwner(cloned);
  if (auth instanceof NextResponse) return auth;
  const { orgId } = auth;

  const svc = supabaseService();
  const { data: tenant } = await svc.from("tenants")
    .select("sender_resend_domain_id").eq("id", orgId).maybeSingle();
  const apiKey = process.env.RESEND_API_KEY;
  // Best-effort: delete from Resend. If it fails, we still clear our local
  // record so the tenant can re-add or fall back to shared sender.
  if (tenant?.sender_resend_domain_id && apiKey) {
    await fetch(`https://api.resend.com/domains/${tenant.sender_resend_domain_id}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${apiKey}` },
    }).catch(() => null);
  }

  await svc.from("tenants").update({
    sender_domain:           null,
    sender_email:            null,
    sender_resend_domain_id: null,
    sender_verified:         false,
  }).eq("id", orgId);

  return NextResponse.json({ ok: true });
}
