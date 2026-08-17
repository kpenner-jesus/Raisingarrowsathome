// PATCH /api/platform/custom-domain
//
// Super-admin only. Sets (or clears) a tenant's own web address.
//
// Setting this row is only ONE of three steps — the other two are outside the
// app and the response says so, because a half-configured domain looks
// identical to a broken one:
//   1. this value                                   ← what this route does
//   2. attach the domain in the hosting dashboard + point DNS
//   3. add the domain to the Supabase Auth redirect allowlist
// Miss (3) and every magic-link sign-in on the domain fails silently, because
// the login page builds its redirect from window.location.origin.

import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { normalizeCustomDomainInput } from "@/app/lib/org-routing";
import { writeAudit } from "@/app/lib/audit";

export const dynamic = "force-dynamic";

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
  const orgId = typeof body?.orgId === "string" ? body.orgId : null;
  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 });

  const raw = typeof body?.domain === "string" ? body.domain : "";
  const hadInput = raw.trim().length > 0;
  const domain = normalizeCustomDomainInput(raw);

  // An empty box means "clear it". A non-empty box that normalizes to null
  // means the operator typed something unusable — say so rather than silently
  // clearing the domain they were trying to set.
  if (hadInput && domain === null) {
    return NextResponse.json({
      error: "That doesn't look like a web address. Use just the hostname — for example grants.cedarchurch.org — with no https://, port or trailing path.",
    }, { status: 400 });
  }

  const { data: before } = await svc
    .from("tenants").select("slug, custom_domain").eq("id", orgId).maybeSingle();
  if (!before) return NextResponse.json({ error: "No such tenant." }, { status: 404 });

  const { error } = await svc.from("tenants").update({ custom_domain: domain }).eq("id", orgId);
  if (error) {
    // 23505 = unique violation: another tenant already claims this domain.
    // 23514 = the canonical-form CHECK, which normalizeCustomDomainInput
    //         should have caught first — report it rather than a raw error.
    const code = (error as any).code;
    if (code === "23505") {
      return NextResponse.json({ error: `${domain} is already assigned to another charity.` }, { status: 409 });
    }
    if (code === "23514") {
      return NextResponse.json({ error: "That web address isn't in a form we can route on." }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await writeAudit({
    orgId,
    actorId: user.id,
    action: "set_custom_domain",
    targetTable: "tenants",
    targetId: orgId,
    details: { from: before.custom_domain ?? null, to: domain },
  }).catch(() => { /* never fail the request on an audit write */ });

  return NextResponse.json({
    ok: true,
    orgId,
    custom_domain: domain,
    next_steps: domain
      ? [
          `Attach ${domain} to the hosting project and point its DNS.`,
          `Add https://${domain} to the Supabase Auth redirect allowlist — without this, sign-in links on the domain fail silently.`,
        ]
      : [],
  });
}
